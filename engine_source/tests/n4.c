void scale(float * restrict a, float * restrict b, float k, int n) { for (int i = 0; i < n; i++) a[i] = b[i] * k + 1.5f; }
void tof(float * restrict a, int * restrict b, int n) { for (int i = 0; i < n; i++) a[i] = (float) b[i]; }
unsigned int h(unsigned int x) { return (x << 3) ^ (x >> 2); }
short sh(short a, short b) { return a * b; }
int cnt(char *s) { int n = 0; while (s[n] != 0) n++; return n; }
int main() { char name[] = "compiler"; return cnt(name) + h(7) + sh(300, 300); }
