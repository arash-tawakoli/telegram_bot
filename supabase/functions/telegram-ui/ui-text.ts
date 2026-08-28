import { LANGS, msg as baseMsg, typeLabel } from "./ui-text-v2.ts";
export { LANGS, typeLabel };
export function msg(lang:string|null|undefined,key:string){
  if(key==="chooseB") return baseMsg(lang,"chooseBPrompt");
  return baseMsg(lang,key);
}
