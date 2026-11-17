"""Stops the worker opening a socket or starting a process, whatever code asks.

A Python audit hook cannot be removed once installed. It covers Python and the
standard library, not native code calling the OS directly, so only this
package and numpy may run in the worker.
"""
import sys

PROCESS_EVENTS = {"subprocess.Popen", "os.system", "os.exec", "os.fork", "os.forkpty", "os.posix_spawn", "os.spawn", "pty.spawn"}


def _deny(event: str, _args: tuple) -> None:
    if event.startswith("socket.") or event in PROCESS_EVENTS:
        raise PermissionError(f"the quant worker may not use {event}")


def install() -> None:
    sys.addaudithook(_deny)
