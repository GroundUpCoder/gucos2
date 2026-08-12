/* Legacy header — equivalent to <string.h> on all modern systems.
 * Some old code (including the SQLite base85 extension in shell.c)
 * still includes it. Just redirect. */
#ifndef _MEMORY_H_SHIM
#define _MEMORY_H_SHIM
#include <string.h>
#endif
