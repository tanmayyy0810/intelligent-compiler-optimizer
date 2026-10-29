void vadd(int * restrict c, int * restrict a, int * restrict b, int n) {
    for (int i = 0; i < n; i++)
        c[i] = a[i] + b[i] * 2;
}
int local100() {
    int a[100]; int b[100]; int c[100];
    for (int i = 0; i < 100; i++) { a[i] = i; b[i] = 2 * i; }
    for (int i = 0; i < 100; i++) c[i] = a[i] + b[i];
    return c[99];
}
