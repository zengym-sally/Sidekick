export function forwardListenerSignals(child, owner = process) {
  let timer;
  const interrupt = () => stop(130);
  const terminate = () => stop(143);
  function stop(exitCode) {
    owner.exitCode = exitCode;
    child.kill('SIGTERM');
    timer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
    timer.unref();
  }
  owner.on('SIGINT', interrupt);
  owner.on('SIGTERM', terminate);
  child.once('exit', () => {
    clearTimeout(timer);
    owner.removeListener('SIGINT', interrupt);
    owner.removeListener('SIGTERM', terminate);
  });
}
