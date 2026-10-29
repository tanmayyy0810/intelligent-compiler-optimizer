/* 19. Prefix sum (loop-carried dependence)
 * a[i] depends on a[i-1]: vectorization is rejected, but unrolling keeps the order and is applied.
 */
int prefix(int *a, int n) {
    for (int i = 1; i < n; i++) a[i] = a[i - 1] + a[i];
    return a[n - 1];
}
