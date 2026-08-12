export type RecognitionHandle={stop():void;onresult?:unknown;onerror?:unknown;onend?:unknown};
export type RecordingHandle={media:{state:string;stop():void;ondataavailable:unknown;onstop:unknown};stream:{getTracks():Array<{stop():void}>};abort:AbortController;timer?:number};
export function disposeRecognition(handle:RecognitionHandle|null){if(!handle)return;handle.onresult=undefined;handle.onerror=undefined;handle.onend=undefined;handle.stop()}
export function disposeRecording(handle:RecordingHandle|null){if(!handle)return;if(handle.timer)clearTimeout(handle.timer);handle.media.ondataavailable=null;handle.media.onstop=null;handle.abort.abort();if(handle.media.state!=='inactive')handle.media.stop();handle.stream.getTracks().forEach(track=>track.stop())}
