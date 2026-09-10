import {db,send,edit,esc,button,saveState,telegram,secret} from './runtime.js';
import {premium} from './navigation.js';
import {DOCUMENT_KINDS,PROFILE_FIELDS,FILE_LIMIT,validId,privateApplicant,profileValue,detectDocument,boundedFile} from './dossier-rules.js';

const bucket = () => db.storage.from('application-documents');
const pathFor = row => `${row.user_id}/${row.id}`;
const back = [[button('← Bewerbermappe','dossier')]];
const render = (chat,id,text,rows) => id ? edit(chat,id,text,{inline_keyboard:rows}) : send(chat,text,{inline_keyboard:rows});
async function profile(user) {
    const {data,error}=await db.from('bot_users').select('applicant_profile').eq('id',user.id).single();
    if(error)throw Error('Bewerberprofil konnte nicht geladen werden.');
    return data.applicant_profile || {};
}
async function patchProfile(user, patch) {
    const current=await profile(user);
    const {error}=await db.from('bot_users').update({applicant_profile:{...current,...patch}}).eq('id',user.id);
    if(error)throw Error('Bewerberprofil konnte nicht gespeichert werden.');
}
export async function clearDossierInput(user) {
    if(!user.onboarding_state?.dossier_input)return;
    const state={...user.onboarding_state};delete state.dossier_input;
    await saveState(user.id,user.onboarding_step,state);user.onboarding_state=state;
}
async function document(user,id) {
    if(!validId(id))return null;
    const {data,error}=await db.from('application_documents').select('*').eq('user_id',user.id).eq('id',id).maybeSingle();
    if(error)throw Error('Unterlage konnte nicht geladen werden.');return data;
}
async function removeDocument(row) {
    const {error:storageError}=await bucket().remove([pathFor(row)]);
    if(storageError)throw Error('Datei konnte nicht gelöscht werden. Bitte erneut versuchen.');
    const {error}=await db.from('application_documents').delete().eq('user_id',row.user_id).eq('id',row.id);
    if(error)throw Error('Dateieintrag konnte nicht gelöscht werden. Bitte erneut versuchen.');
}
export async function purgeApplicantDocuments(userId) {
    const {data,error}=await db.from('application_documents').select('id,user_id').eq('user_id',userId);
    if(error)throw Error('Unterlagen konnten nicht geladen werden.');
    for(const row of data || [])await removeDocument(row);
}
async function sendDocument(chat,row) {
    const {data,error}=await bucket().download(pathFor(row));
    if(error)throw Error('Datei konnte nicht geladen werden.');
    const form=new FormData();form.set('chat_id',String(chat));form.set('document',data,row.filename);
    const token=await secret('telegram_bot_token_runtime');
    try {
        const response=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(20000)});
        const result=await response.json();if(!response.ok || !result.ok)throw Error();
    } catch { throw Error('Dokumentversand nicht bestätigt. Bitte im Chat prüfen, bevor du erneut lädst.'); }
}

export async function dossier(user,chat,messageId,data='dossier') {
    if(!privateApplicant(user,chat))return;
    const [,action='',value='',choice='']=data.split(':');
    if(action==='file' || action==='download' || action==='delete' || action==='remove' || action==='share') {
        const row=await document(user,value);
        if(!row)return render(chat.id,messageId,'Unterlage nicht gefunden.',back);
        if(action==='download') { if(row.ready)await sendDocument(chat.id,row); return; }
        if(action==='delete')return render(chat.id,messageId,'Unterlage dauerhaft löschen?',[[button('Ja, löschen',`dossier:remove:${row.id}`)],...back]);
        if(action==='remove'){await removeDocument(row);return dossier(user,chat,messageId);}
        if(action==='share') {
            if(!user.is_premium && choice==='yes')return premium(user,chat.id,messageId);
            if(!row.ready)return;
            const {error}=await db.from('application_documents').update({share_enabled:choice==='yes'}).eq('user_id',user.id).eq('id',row.id);
            if(error)throw Error('Freigabe konnte nicht geändert werden.');
            return dossier(user,chat,messageId,`dossier:file:${row.id}`);
        }
        return render(chat.id,messageId,`📄 <b>${esc(row.filename)}</b>\n${esc(DOCUMENT_KINDS[row.kind])}\n\n${row.ready?'Hochgeladen':'Upload unvollständig – bitte löschen und erneut hochladen.'}\nAutomatische Weitergabe: ${row.share_enabled?'freigegeben':'nicht freigegeben'}\n\nEine Freigabe gilt für künftige automatische Bewerbungen. Der automatische Plattformversand ist noch nicht verfügbar.`,[
            ...(row.ready?[[button('Datei herunterladen',`dossier:download:${row.id}`)]]:[]),
            ...(row.ready&&(user.is_premium||row.share_enabled)?[[button(row.share_enabled?'Weitergabe sperren':'Weitergabe erlauben',`dossier:share:${row.id}:${row.share_enabled?'no':'yes'}`)]]:[]),
            [button('Datei löschen',`dossier:delete:${row.id}`)],...back]);
    }
    if(action==='field' || action==='upload' || action==='has') {
        if(!user.is_premium)return premium(user,chat.id,messageId);
        if(action==='has') {
            if(!Object.hasOwn(DOCUMENT_KINDS,value) || !['yes','no','unknown'].includes(choice))return;
            const p=await profile(user);await patchProfile(user,{documents:{...p.documents,[value]:choice}});
            return dossier(user,chat,messageId);
        }
        const labels=action==='field'?PROFILE_FIELDS:DOCUMENT_KINDS;
        if(!Object.hasOwn(labels,value))return;
        await saveState(user.id,user.onboarding_step,{...user.onboarding_state,dossier_input:{action,value,started_at:Date.now()}});
        return render(chat.id,messageId,action==='field'
            ? `📝 ${esc(labels[value])}\n\nSende den Wert als nächste Nachricht, oder - zum Löschen. Eingabe gilt 10 Minuten.`
            : `📎 ${esc(labels[value])}\n\nSende eine PDF-, JPG- oder PNG-Datei mit maximal 5 MB. Für unveränderte Bilder in Telegram „Datei“ verwenden. Upload gilt 10 Minuten. Jede Datei ist zunächst für die automatische Weitergabe gesperrt.`,back);
    }
    if(action==='kind') {
        if(!Object.hasOwn(DOCUMENT_KINDS,value))return;
        return render(chat.id,messageId,`${esc(DOCUMENT_KINDS[value])}\n\nIst der Nachweis vorhanden? Diese Angabe bestätigt weder den Inhalt noch eine Prüfung.`,[
            [button('Vorhanden',`dossier:has:${value}:yes`),button('Nicht vorhanden',`dossier:has:${value}:no`)],
            [button('Noch offen',`dossier:has:${value}:unknown`)],[button('Datei hochladen',`dossier:upload:${value}`)],...back]);
    }
    if(action==='clear-profile')return render(chat.id,messageId,'Alle Bewerberangaben und den Bewerbungstext löschen? Hochgeladene Dateien bleiben separat löschbar.',[[button('Angaben löschen','dossier:erase-profile')],...back]);
    if(action==='erase-profile') {
        const {error}=await db.from('bot_users').update({applicant_profile:{},auto_apply_enabled:false}).eq('id',user.id);
        if(error)throw Error('Bewerberangaben konnten nicht gelöscht werden.');
        return dossier(user,chat,messageId);
    }
    const p=await profile(user);
    const {data:rows,error}=await db.from('application_documents').select('*').eq('user_id',user.id).order('created_at',{ascending:false});
    if(error)throw Error('Unterlagen konnten nicht geladen werden.');
    const presence={yes:'vorhanden',no:'nicht vorhanden',unknown:'noch offen'};
    const text=['📂 <b>Meine Bewerbermappe</b>',user.is_premium?'💎 Premium aktiv':'Premium erforderlich zum Bearbeiten. Herunterladen und Löschen eigener Dateien bleiben möglich.','',
        ...Object.entries(PROFILE_FIELDS).map(([key,label])=>`${label}: ${esc(p[key]??'noch offen')}`),'',
        ...Object.entries(DOCUMENT_KINDS).map(([key,label])=>`${label}: ${presence[p.documents?.[key]]||'noch offen'}`),'',
        'Automatischer Plattformversand: noch nicht verfügbar.','Dateien werden privat gespeichert und erst nach ausdrücklicher Freigabe zur Weitergabe vorgesehen.'].join('\n');
    const keyboard=[...(user.is_premium?[
        ...Object.entries(PROFILE_FIELDS).map(([key,label])=>[button(`✏️ ${label}`,`dossier:field:${key}`)]),
        ...Object.entries(DOCUMENT_KINDS).map(([key,label])=>[button(`📎 ${label}`,`dossier:kind:${key}`)])]:[[button('💎 Premium','premium')]]),
        ...(rows||[]).map(row=>[button(`📄 ${row.filename.slice(0,40)}`,`dossier:file:${row.id}`)]),[button('🔐 Plattformkonten / Auto-Bewerbung','platforms')],[button('Bewerberangaben löschen','dossier:clear-profile')],[button('← Startmenü','home')]];
    return render(chat.id,messageId,text,keyboard);
}

export async function dossierMessage(message,user) {
    const pending=user.onboarding_state?.dossier_input;
    if(!pending || !privateApplicant(user,message.chat))return false;
    if(String(message.text||'').startsWith('/')){await clearDossierInput(user);return false;}
    if(!user.is_premium || Date.now()-pending.started_at>600000){await clearDossierInput(user);await send(message.chat.id,'Eingabe abgelaufen oder Premium nicht aktiv. Bitte /mappe öffnen.');return true;}
    if(pending.action==='field') {
        let value;try{value=profileValue(pending.value,message.text);}catch(e){await send(message.chat.id,esc(e.message));return true;}
        await patchProfile(user,{[pending.value]:value});
    } else if(pending.action==='upload' && Object.hasOwn(DOCUMENT_KINDS,pending.value)) {
        const file=message.document || message.photo?.at(-1);
        if(!file?.file_id || !file.file_size || file.file_size>FILE_LIMIT){await send(message.chat.id,'Bitte PDF, JPG oder PNG mit maximal 5 MB senden.');return true;}
        let bytes,mime;
        try {
            const info=await telegram('getFile',{file_id:file.file_id});
            if(!/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(info.file_path||'') || info.file_path.includes('..'))throw Error();
            const token=await secret('telegram_bot_token_runtime');
            bytes=await boundedFile(await fetch(`https://api.telegram.org/file/bot${token}/${info.file_path}`,{signal:AbortSignal.timeout(20000)}));
            mime=detectDocument(bytes);
        } catch { await send(message.chat.id,'Upload nicht möglich. Bitte eine gültige PDF-, JPG- oder PNG-Datei bis 5 MB senden.');return true; }
        const filename=`${DOCUMENT_KINDS[pending.value]}.${mime==='application/pdf'?'pdf':mime==='image/jpeg'?'jpg':'png'}`;
        const {error:reserveError}=await db.from('application_documents').upsert({user_id:user.id,kind:pending.value,telegram_message_id:message.message_id,filename,mime_type:mime,bytes:bytes.length},{onConflict:'user_id,telegram_message_id',ignoreDuplicates:true});
        if(reserveError)throw Error('Dateieintrag konnte nicht angelegt werden.');
        const {data:row,error:readError}=await db.from('application_documents').select('*').eq('user_id',user.id).eq('telegram_message_id',message.message_id).single();
        if(readError)throw Error('Dateieintrag konnte nicht geladen werden.');
        if(!row.ready) {
            const {error:uploadError}=await bucket().upload(pathFor(row),bytes,{contentType:mime,upsert:true});
            if(uploadError)throw Error('Datei konnte nicht gespeichert werden.');
            const {error}=await db.from('application_documents').update({ready:true}).eq('user_id',user.id).eq('id',row.id);
            if(error)throw Error('Upload konnte nicht bestätigt werden.');
        }
    } else { await clearDossierInput(user);return false; }
    await clearDossierInput(user);await dossier(user,message.chat);return true;
}
