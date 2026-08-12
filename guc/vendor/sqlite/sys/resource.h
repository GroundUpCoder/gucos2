/* Shim for sys/resource.h. SQLite's shell.c uses this for getrusage()
 * to drive the .timer command. There's no underlying timing API in
 * our wasm host, so getrusage() is a no-op that zeros the buffer —
 * .timer will report 0.000s of CPU time for every command, but the
 * shell otherwise works. */
#ifndef _SYS_RESOURCE_H_SHIM
#define _SYS_RESOURCE_H_SHIM
#include <sys/time.h>
#include <string.h>

#define RUSAGE_SELF      0
#define RUSAGE_CHILDREN -1

struct rusage {
  struct timeval ru_utime;  /* user CPU time used */
  struct timeval ru_stime;  /* system CPU time used */
};

static inline int getrusage(int who, struct rusage *r) {
  (void)who;
  if (r) memset(r, 0, sizeof(*r));
  return 0;
}
#endif
