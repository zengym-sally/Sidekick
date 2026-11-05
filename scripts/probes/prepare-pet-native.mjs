import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {copyExecutable} from '../build/copy-executable.mjs';
import {resolve,join} from 'node:path';
import {release} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url)),env={...process.env};
if(process.platform!=='darwin')throw Error('The pet native probe requires macOS.');
if(Number(release().split('.')[0])>=26){
 if(env.RUSTC_WRAPPER)throw Error('An existing RUSTC_WRAPPER requires review before chaining.');
 env.RUSTC_WRAPPER=join(root,'scripts/probes/rustc-host-macro.py');
}
const result=spawnSync('cargo',['build','--manifest-path','src-tauri/Cargo.toml','--features','pet-native-probe','--example','pet-native-probe'],{cwd:root,env,stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
const folder=resolve(root,'build/pet-native-20261105'),app=join(folder,'Sidekick Pet Probe.app'),macos=join(app,'Contents/MacOS');
mkdirSync(macos,{recursive:true,mode:0o700});
await copyExecutable(join(root,'src-tauri/target/debug/examples/pet-native-probe'),join(macos,'pet-native-bin'));
const identity=JSON.parse(readFileSync(join(root,'tests/fixtures/s1-profile-verify.config.json'),'utf8')).identifier;
writeFileSync(join(app,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>pet-native-probe</string><key>CFBundleName</key><string>Sidekick Pet Probe</string><key>CFBundleIdentifier</key><string>${identity}</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>\n`);
writeFileSync(join(macos,'pet-native-probe'),'#!/bin/sh\nprobe_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$probe_dir/pet-native-bin" >> "$probe_dir/../../../probe.ndjson" 2>&1\n');
chmodSync(join(macos,'pet-native-probe'),0o700);
const signed=spawnSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
if(signed.status!==0)process.exit(signed.status??1);
console.log(JSON.stringify({app,log:join(folder,'probe.ndjson'),businessStore:false,ephemeralWebviews:true}));
