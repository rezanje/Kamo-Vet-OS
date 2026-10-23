import {Children,isValidElement,type ReactNode} from 'react';

/** Read server-rendered controls, never dirty browser values. Unknown custom controls
 * remain represented by their applied URL parameters, not inferred from the DOM. */
export function reportFilterDefaults(filter:ReactNode):string {
 const params=new URLSearchParams();
 function visit(nodes:ReactNode){Children.forEach(nodes,node=>{
  if(!isValidElement(node))return;
  const props=node.props as {name?:string;type?:string;disabled?:boolean;defaultChecked?:boolean;checked?:boolean;defaultValue?:unknown;value?:unknown;children?:ReactNode};
  if(typeof node.type==='string'&&['input','select','textarea'].includes(node.type)&&props.name&&!props.disabled){
   if(['submit','button','reset','file','password'].includes(props.type??''))return;
   if(['checkbox','radio'].includes(props.type??'')&&!(props.checked??props.defaultChecked))return;
   const value=props.value??props.defaultValue??(['checkbox','radio'].includes(props.type??'')?'on':'');
   for(const item of Array.isArray(value)?value:[value])if(typeof item==='string'||typeof item==='number')params.append(props.name,String(item));
  } else visit(props.children);
 });}
 visit(filter);return params.toString();
}
