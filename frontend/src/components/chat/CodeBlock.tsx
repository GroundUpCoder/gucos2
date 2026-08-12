import {memo,useState,type ComponentProps} from 'react';
import {Check,Copy} from 'lucide-react';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import {oneDark} from 'react-syntax-highlighter/dist/esm/styles/prism';
import {useReaderSize} from '../../agent/reader-size';

const labels:Record<string,string>={js:'JavaScript',jsx:'JavaScript',ts:'TypeScript',tsx:'TypeScript',sh:'Shell',bash:'Bash',py:'Python',json:'JSON',html:'HTML',css:'CSS',md:'Markdown'};
export const CodeBlock=memo(function CodeBlock({className,children,...props}:ComponentProps<'code'> & {'data-fence-closed'?:string}){
 const size=useReaderSize(),[copied,setCopied]=useState(false),code=String(children).replace(/\n$/,''),language=/language-([^ ]+)/.exec(className??'')?.[1]??'',inline=!className&&!code.includes('\n'),closed=props['data-fence-closed']!=='false',label=labels[language]??(language||'Text'),fontSize={small:12,medium:13,large:14,xlarge:16}[size];
 if(inline)return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[.9em] before:content-none after:content-none">{children}</code>;
 const copy=async()=>{await navigator.clipboard.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),1500)};
 return <div className="my-3 min-w-0 max-w-full overflow-hidden rounded-lg border bg-[#282c34]" data-testid="code-block" data-fence-closed={String(closed)}><div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-xs text-neutral-300"><span className="font-mono">{label}{!closed?' · streaming…':''}</span><button type="button" onClick={()=>void copy()} aria-label="Copy code" className="flex items-center gap-1 rounded px-2 py-1 hover:bg-white/10">{copied?<Check className="size-4"/>:<Copy className="size-4"/>}{copied?'Copied':'Copy'}</button></div>{closed?<SyntaxHighlighter style={oneDark} language={language||'text'} PreTag="div" customStyle={{margin:0,maxHeight:'28rem',overflow:'auto',borderRadius:0,fontSize}}>{code}</SyntaxHighlighter>:<pre className="max-h-[28rem] overflow-auto p-3 text-neutral-100" style={{fontSize}}><code>{code}</code></pre>}</div>
});
