/* 30. Matrix add (flat 2-D)
 * Rows are contiguous: the inner j loop has stride 1 on every array.
 */
void madd(int * restrict c, int * restrict a, int * restrict b, int n) {
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            c[i * n + j] = a[i * n + j] + b[i * n + j];
}
