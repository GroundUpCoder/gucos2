import {useSyncExternalStore} from 'react';

export type ReaderSize='small'|'medium'|'large'|'xlarge';
export const READER_SIZES:readonly ReaderSize[]=['small','medium','large','xlarge'];
export const READER_SIZE_LABELS:Record<ReaderSize,string>={small:'Small',medium:'Medium',large:'Large',xlarge:'X-Large'};
export const READER_SIZE_PROSE_CLASSES:Record<ReaderSize,string>={small:'prose-sm',medium:'',large:'prose-lg',xlarge:'prose-xl'};
export const READER_SIZE_TEXT_CLASSES:Record<ReaderSize,string>={small:'text-sm',medium:'text-base',large:'text-lg',xlarge:'text-xl'};
export const READER_SIZE_CODE_CLASSES:Record<ReaderSize,string>={small:'text-xs',medium:'text-[13px]',large:'text-sm',xlarge:'text-base'};
const KEY='gucos2:reader-size',DEFAULT:ReaderSize='large',listeners=new Set<()=>void>();
export const resolveReaderSize=(raw:string|null):ReaderSize=>READER_SIZES.includes(raw as ReaderSize)?raw as ReaderSize:DEFAULT;
export const getReaderSize=()=>{try{return resolveReaderSize(localStorage.getItem(KEY))}catch{return DEFAULT}};
let cached:ReaderSize=typeof window==='undefined'?DEFAULT:getReaderSize();
const emit=()=>{cached=getReaderSize();listeners.forEach(listener=>listener())};
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===null||event.key===KEY)emit()});
export function setReaderSize(size:ReaderSize){try{localStorage.setItem(KEY,size)}catch{/* browser storage unavailable */}emit()}
export function useReaderSize(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>cached,()=>DEFAULT)}
