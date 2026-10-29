#!/usr/bin/env python3
import os
import sys

args = sys.argv[1:]
env = dict(os.environ)
if '--crate-type' in args and args[args.index('--crate-type') + 1] == 'proc-macro':
    env.pop('MACOSX_DEPLOYMENT_TARGET', None)
os.execvpe(args[0], args, env)
