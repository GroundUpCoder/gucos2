#include <string.h>

__import int __egress(int disposition, const void *paths, int length);

int main(void) {
  const char path[] = "/root/mobile-proof\n";
  return __egress(1, path, (int)strlen(path)) == 0 ? 0 : 1;
}
