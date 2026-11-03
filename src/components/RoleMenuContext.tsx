"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { AturanTersimpan } from "@/lib/akses";
const Context = createContext<{role:string;rules:AturanTersimpan}|null>(null);
export function RoleMenuProvider({role,rules,children}:{role:string;rules:AturanTersimpan;children:ReactNode}) {return <Context.Provider value={{role,rules}}>{children}</Context.Provider>;}
export const useRoleMenu = () => useContext(Context);
