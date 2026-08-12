import {memo} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {remarkFenceState} from '../../agent/fenced-block';
import {resolveAgentPath,WORKSPACE} from '../../agent/workspace';
import {CodeBlock} from './CodeBlock';
import {READER_SIZE_PROSE_CLASSES,useReaderSize} from '../../agent/reader-size';

const safeUrl=(url:string)=>{try{const base=globalThis.location?.href??'http://localhost/',origin=new URL(base).origin,parsed=new URL(url,base);return ['http:','https:','mailto:'].includes(parsed.protocol)||parsed.origin===origin?url:''}catch{return ''}};
const linkTarget=(href:string|undefined)=>{if(!href||/^(https?:|mailto:|#|\/\/)/i.test(href))return href;if(href.startsWith('/root/'))return `${href.endsWith('/')?'/files':'/edit'}${href}`;if(href.startsWith('/'))return href;const resolved=resolveAgentPath(decodeURIComponent(href.split(/[?#]/)[0]));if(resolved!==WORKSPACE&&!resolved.startsWith(`${WORKSPACE}/`))return '';return `${href.endsWith('/')?'/files':'/edit'}${resolved}`};
export const Markdown=memo(function Markdown({children}:{children:string}){const size=useReaderSize();return <div className={`prose ${READER_SIZE_PROSE_CLASSES[size]} dark:prose-invert max-w-none break-words prose-pre:my-0`} data-reader-size={size} data-testid="markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkFenceState]} urlTransform={safeUrl} components={{code:CodeBlock,pre:({children})=><div className="not-prose">{children}</div>,table:({children})=><div className="not-prose max-w-full overflow-x-auto rounded-md border"><table className="w-max min-w-full border-collapse text-[1em]">{children}</table></div>,th:({children})=><th className="border-b border-r bg-muted px-3 py-2 text-left">{children}</th>,td:({children})=><td className="border-b border-r px-3 py-2 align-top">{children}</td>,a:({href,children})=>{const external=!!href&&/^https?:/i.test(href);return <a href={linkTarget(href)} target={external?'_blank':undefined} rel={external?'noopener noreferrer':undefined}>{children}</a>}}}>{children}</ReactMarkdown></div>});
