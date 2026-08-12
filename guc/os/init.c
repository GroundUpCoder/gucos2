#include <sys/wait.h>
#include <unistd.h>

/* PID 1 for the terminal-only fork. Browser PTY sessions are kernel-owned
 * children (ppid 0), so init has no policy beyond staying alive and reaping
 * anything that is orphaned to it. */
int main(void) {
    int status;
    for (;;) {
        while (waitpid(-1, &status, 0) > 0) {}
        sleep(1);
    }
}
