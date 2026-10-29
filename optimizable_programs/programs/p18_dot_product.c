/* 18. Dot product
 * Two input arrays and an accumulator; unrolled ×4 with a remainder loop.
 */
int dot(int *a, int *b, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i] * b[i];
    return s;
}
