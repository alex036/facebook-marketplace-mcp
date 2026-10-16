import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
if (process.platform !== 'darwin') throw new Error('This UI startup helper is for macOS; npm run tracker works elsewhere.');
const root=fileURLToPath(new URL('../',import.meta.url));
const data=process.env.DONOR_TRACKER_DIR??path.join(os.homedir(),'Library/Application Support/Partloop Donor Tracker');
fs.mkdirSync(data,{recursive:true,mode:0o700});
const dir=path.join(os.homedir(),'Library/LaunchAgents');fs.mkdirSync(dir,{recursive:true});
const label='ca.partloop.donor-tracker';
const target=path.join(dir,label+'.plist');
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const plist=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(root,'dist/tracker/cli.js'))}</string><string>serve</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>EnvironmentVariables</key><dict><key>CHROME_PROFILE</key><string>Default</string><key>DONOR_TRACKER_DIR</key><string>${xml(data)}</string></dict>
<key>StandardOutPath</key><string>${xml(path.join(data,'ui.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(data,'ui-error.log'))}</string>
</dict></plist>`;
const domain=`gui/${process.getuid()}`;
try { execFileSync('launchctl',['bootout',`${domain}/${label}`],{stdio:'pipe'}); } catch {}
fs.writeFileSync(target,plist,{mode:0o600});
execFileSync('launchctl',['bootstrap',domain,target],{stdio:'pipe'});
console.log(`Local UI installed at http://127.0.0.1:4318 (LaunchAgent ${label})`);
