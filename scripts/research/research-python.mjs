import path from 'node:path';
export function requireResearchPython(env=process.env){
 const executable=env.USHSO_RESEARCH_PYTHON;
 if(typeof executable!=='string'||!path.isAbsolute(executable)||executable.includes('\0')||executable.length>4096)throw Error('RESEARCH_PYTHON_ABSOLUTE_PATH_REQUIRED');
 return executable;
}
