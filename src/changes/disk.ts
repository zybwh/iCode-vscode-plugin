import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import type {DiffEntry} from "../acp/types";

/** Refuse to overwrite edits made outside the recorded mutation history. */
export async function matchesRecordedFile(entry:DiffEntry):Promise<boolean>{
  if(entry.afterHash===undefined)return false;
  try{
    const digest=createHash("sha256");
    for await(const chunk of createReadStream(entry.path))digest.update(chunk);
    return digest.digest("hex")===entry.afterHash;
  }catch(error){
    if((error as NodeJS.ErrnoException).code==="ENOENT")return entry.afterHash===null;
    throw error;
  }
}
