import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const W=1200,H=1200;
const patterns={
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '%':['11001','11010','00100','01000','10110','00110','00000'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
};
function drawGlyph(raw:Uint8Array,ch:string,x0:number,y0:number,scale:number){const p=(patterns as Record<string,string[]>)[ch];if(!p)return;for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++)if(p[gy][gx]==='1')for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){const px=x0+gx*scale+x,py=y0+gy*scale+y;if(px<0||py<0||px>=W||py>=H)continue;const i=py*(W*4+1)+1+px*4;raw[i]=255;raw[i+1]=255;raw[i+2]=255;raw[i+3]=255;}}
function drawText(raw:Uint8Array,text:string,x:number,y:number,scale:number,gap=Math.floor(scale*.8)){let cx=x;for(const ch of text){drawGlyph(raw,ch,cx,y,scale);cx+=5*scale+gap;}}
function crc32(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function u32(n:number){return new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
function concat(...parts:Uint8Array[]){const n=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;}
function chunk(type:string,data:Uint8Array){const t=new TextEncoder().encode(type);return concat(u32(data.length),t,data,u32(crc32(concat(t,data))));}
async function makePng(){const stride=W*4+1,raw=new Uint8Array(stride*H);for(let y=0;y<H;y++){const fy=y/(H-1);raw[y*stride]=0;for(let x=0;x<W;x++){const fx=x/(W-1),t=.58*fx+.42*fy;let r=249*(1-t)+255*t,g=20*(1-t)+227*t,b=154*(1-t)+199*t;const dx=(x-W*.76)/(W*.55),dy=(y-H*.72)/(H*.55),bloom=Math.max(0,1-Math.hypot(dx,dy))*.17;r=r*(1-bloom)+255*bloom;g=g*(1-bloom)+245*bloom;b=b*(1-bloom)+229*bloom;const i=y*stride+1+x*4;raw[i]=r;raw[i+1]=g;raw[i+2]=b;raw[i+3]=255;}}drawText(raw,'50',120,220,80,70);drawText(raw,'%',835,210,45,30);drawText(raw,'OFF',300,700,50,35);const cs=new CompressionStream('deflate'),compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer());const ihdr=concat(u32(W),u32(H),new Uint8Array([8,6,0,0,0]));return concat(new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',compressed),chunk('IEND',new Uint8Array()));}
const PNG=await makePng();
Deno.serve((req:Request)=>{if(req.method!=='GET'&&req.method!=='HEAD')return new Response('method not allowed',{status:405});return new Response(req.method==='HEAD'?null:PNG,{headers:{'content-type':'image/png','content-length':String(PNG.length),'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff','x-image-size':'1200x1200'}});});