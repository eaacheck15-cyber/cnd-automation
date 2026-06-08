; runner.ahk — invocado pelo Node por step.
; Uso: AutoHotkey64.exe runner.ahk <action> <arg1> <arg2> ...
;   click   <x> <y>                 — clica nas coordenadas absolutas da tela
;   dblclick <x> <y>                — double-click
;   move    <x> <y>                 — move o mouse sem clicar (debug)
;   type    <text>                  — digita texto no foco atual (usa SendText, suporta acentos)
;   key     <keyname>               — pressiona uma tecla (Tab, Enter, Esc, etc.)
;   focus   <window_title_substr>   — traz janela para frente por substring do título
;
; Saída: imprime "OK" em stdout em sucesso; "ERR: <mensagem>" em falha.
; Exit code 0 = sucesso, 1 = falha.

#Requires AutoHotkey v2.0
#SingleInstance Off
SetWorkingDir A_ScriptDir

if A_Args.Length < 1 {
    FileAppend "ERR: action required`n", "*"
    ExitApp 1
}

action := A_Args[1]

try {
    switch action {
        case "click":
            if A_Args.Length < 3
                throw Error("click requires x y")
            x := Integer(A_Args[2])
            y := Integer(A_Args[3])
            MouseMove x, y, 5
            Sleep 50
            Click x, y
            FileAppend "OK`n", "*"

        case "dblclick":
            if A_Args.Length < 3
                throw Error("dblclick requires x y")
            x := Integer(A_Args[2])
            y := Integer(A_Args[3])
            MouseMove x, y, 5
            Sleep 50
            Click x, y, 2
            FileAppend "OK`n", "*"

        case "move":
            if A_Args.Length < 3
                throw Error("move requires x y")
            MouseMove Integer(A_Args[2]), Integer(A_Args[3]), 5
            FileAppend "OK`n", "*"

        case "type":
            if A_Args.Length < 2
                throw Error("type requires text")
            ; SendText preserva acentos e caracteres especiais (não interpreta {})
            SendText A_Args[2]
            FileAppend "OK`n", "*"

        case "key":
            if A_Args.Length < 2
                throw Error("key requires keyname")
            Send "{" A_Args[2] "}"
            FileAppend "OK`n", "*"

        case "focus":
            if A_Args.Length < 2
                throw Error("focus requires window title substring")
            title := A_Args[2] " ahk_exe chrome.exe"
            if !WinExist(title)
                throw Error("window not found: " A_Args[2])
            WinActivate
            WinWaitActive , , 5
            FileAppend "OK`n", "*"

        default:
            throw Error("unknown action: " action)
    }
    ExitApp 0
} catch Error as e {
    FileAppend "ERR: " e.Message "`n", "*"
    ExitApp 1
}
