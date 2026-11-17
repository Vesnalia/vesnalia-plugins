/** Panel styles on VesnALIA theme tokens; every selector is scoped under `.aliaae`. */
export const styles = `
.aliaae{--line:var(--border);display:flex;flex-direction:column;height:100%;min-height:0;background:var(--background);color:var(--foreground);font-size:14px;position:relative}
.aliaae *{box-sizing:border-box}
.aliaae button,.aliaae select,.aliaae textarea{font:inherit;color:inherit}
.aliaae button{cursor:pointer;border:0;background:transparent;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:36px;padding:0 10px}
.aliaae button:hover:not(:disabled){background:var(--accent)}
.aliaae button:disabled{opacity:.45;cursor:default}
.aliaae button:focus-visible,.aliaae select:focus-visible,.aliaae textarea:focus-visible,.aliaae-screen:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.aliaae button[aria-expanded=true]{background:var(--accent);color:var(--accent-foreground)}
.aliaae svg{width:18px;height:18px;flex:none}
.aliaae-header{display:flex;align-items:center;gap:2px;padding:6px 8px;border-bottom:1px solid var(--line);min-height:49px;flex:none;position:relative;z-index:2}
.aliaae-chip{min-width:0;max-width:45%}
.aliaae-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aliaae-icon{width:40px;padding:0!important;color:var(--muted-foreground)}
.aliaae-spacer{flex:1}
.aliaae-dot{width:8px;height:8px;border-radius:50%;background:#a0a3a8;flex:none}
.aliaae-dot.online{background:#2da44e}
.aliaae-popover{position:absolute;top:52px;right:12px;width:min(366px,calc(100% - 24px));padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--popover);color:var(--popover-foreground);box-shadow:0 12px 32px #14141e29;z-index:3;display:flex;flex-direction:column;gap:10px}
.aliaae-popover{transform-origin:top right;animation:aliaae-pop .16s cubic-bezier(.2,.9,.3,1)}
.aliaae-left{left:12px;right:auto;transform-origin:top left}
@keyframes aliaae-pop{from{opacity:0;transform:translateY(-6px) scale(.97)}}
.aliaae-chip span+svg{transition:transform .16s}
.aliaae-chip[aria-expanded=true] span+svg{transform:rotate(180deg)}
@media (prefers-reduced-motion:reduce){.aliaae-popover{animation:none}.aliaae-chip span+svg{transition:none}}
.aliaae-menu{width:240px;padding:6px;gap:0}
.aliaae-menu button{justify-content:flex-start;width:100%}
.aliaae-menu button[aria-current=true]{font-weight:600}
.aliaae-menu .aliaae-hint{margin-left:auto;padding-left:8px}
.aliaae-menu-title{margin:0;padding:6px 10px 4px}
.aliaae-submenu{position:relative}
.aliaae-submenu>.aliaae-popover{top:-7px;left:100%;right:auto;margin-left:4px;transform-origin:top left;max-height:min(360px,70vh);overflow:auto}
.aliaae-choices{display:flex;flex-direction:column;gap:6px;width:min(320px,100%);max-height:40vh;overflow:auto}
.aliaae .aliaae-choices button{justify-content:flex-start;border:1px solid var(--line);background:var(--background);padding:0 14px;min-height:40px}
.aliaae .aliaae-choices button:hover:not(:disabled){background:var(--accent)}
.aliaae-label{font-size:12px;font-weight:600;color:var(--muted-foreground)}
.aliaae select{width:100%;min-width:0;min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--background)}
.aliaae textarea{width:100%;min-height:88px;max-height:240px;resize:vertical;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--background);line-height:1.5}
.aliaae form{display:flex;flex-direction:column;gap:10px}
.aliaae-row{display:flex;align-items:center;gap:8px}
.aliaae-hint{margin:0;font-size:12px;color:var(--muted-foreground)}
.aliaae .aliaae-primary{background:var(--primary);color:var(--primary-foreground);padding:0 14px;font-weight:500;flex:none}
.aliaae .aliaae-primary:hover:not(:disabled){background:color-mix(in srgb,var(--primary) 85%,var(--foreground))}
.aliaae-confirm{margin:0;line-height:1.5}
.aliaae .aliaae-danger{background:#cf222e;color:#fff}
.aliaae .aliaae-danger:hover:not(:disabled){background:#a40e26}
.aliaae-link{color:var(--primary);font-size:13px;min-height:24px!important}
.aliaae-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--muted);overflow:hidden}
.aliaae-screen{max-width:100%;max-height:100%;border:5px solid #1f2023;border-radius:24px;background:#000;box-shadow:0 12px 32px #14141e2e;touch-action:none;cursor:default}
.aliaae-empty{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:420px;text-align:center}
.aliaae-empty h1{font-size:18px;font-weight:600;margin:0}
.aliaae-empty p{margin:0;color:var(--muted-foreground);line-height:1.5}
.aliaae-empty-icon{width:56px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:var(--background);border:1px solid var(--line);color:var(--muted-foreground)}
.aliaae-spinner{width:24px;height:24px;border:3px solid var(--line);border-top-color:var(--primary);border-radius:50%;animation:aliaae-spin .8s linear infinite}
@keyframes aliaae-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.aliaae-spinner{animation-duration:2.4s}}
.aliaae-checks{text-align:left;width:100%}
.aliaae-checks ul{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.aliaae-checks li{display:flex;gap:10px;align-items:flex-start}
.aliaae-checks li.ok svg{color:#2da44e}
.aliaae-checks li.fail svg{color:#cf222e}
.aliaae-checks p{margin:2px 0}
.aliaae-checks code{display:block;font-size:11px;color:var(--muted-foreground);word-break:break-all}
.aliaae-status{margin:0;padding:7px 12px;font-size:12px;line-height:1.4;color:var(--muted-foreground);background:var(--muted);flex:none}
.aliaae-nav{display:flex;justify-content:center;padding:8px 12px 12px;background:var(--muted);flex:none}
.aliaae-nav>div{display:flex;gap:4px;padding:4px;background:var(--background);border:1px solid var(--line);border-radius:12px}
.aliaae-nav .aliaae-icon{width:72px;color:var(--foreground)}
.aliaae-nav svg{width:16px;height:16px}
.aliaae-settings{height:auto;background:transparent;gap:10px;align-items:flex-start}
.aliaae-settings>button{border:1px solid var(--line)}
.aliaae-addresses{list-style:none;margin:0;padding:6px 12px;display:flex;flex-direction:column;width:100%;border:1px solid var(--line);border-radius:10px;background:var(--muted)}
.aliaae-addresses li{padding:4px 0}
.aliaae-addresses li+li{border-top:1px solid var(--line)}
.aliaae-addresses li,.aliaae-addresses form{display:flex;flex-direction:row;align-items:center;gap:6px;width:100%}
.aliaae-addresses code{flex:1;font-size:13px}
.aliaae-addresses input{flex:1;min-width:0;min-height:36px;padding:0 10px;font:inherit;font-family:var(--font-mono,monospace);color:inherit;background:var(--background);border:1px solid var(--line);border-radius:8px}
.aliaae-addresses input:focus-visible{outline:2px solid var(--primary);outline-offset:1px}
.aliaae-error{margin:0;font-size:13px;color:#cf222e}
`;
