/* 25. Vector add with restrict
 * restrict proves the arrays do not overlap: NO_ALIAS, no dependence, unit stride.
 */
void vadd(int * restrict c, int * restrict a, int * restrict b, int n) {
    for (int i = 0; i < n; i++) c[i] = a[i] + b[i];
}
