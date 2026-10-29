/* 29. a*b - d on three inputs
 * Several vector loads, a vector multiply and a vector subtract.
 */
void fma_like(int * restrict out, int * restrict a, int * restrict b, int * restrict d, int n) {
    for (int i = 0; i < n; i++) out[i] = a[i] * b[i] - d[i];
}
