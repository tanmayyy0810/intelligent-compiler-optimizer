/* 48. Contrast: plain pointers may alias
 * Without restrict, c may overlap a or b, so vectorization is REJECTED and only unrolling is used.
 */
void vadd_plain(int *c, int *a, int *b, int n) {
    for (int i = 0; i < n; i++) c[i] = a[i] + b[i];
}
