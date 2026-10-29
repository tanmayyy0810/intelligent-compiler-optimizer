/* 11. Helper call inside a loop
 * Removing the call exposes a call-free loop body that can then be unrolled.
 */
int avg(int a, int b) { return (a + b) / 2; }
int smooth_sum(int *a, int n) {
    int s = 0;
    for (int i = 0; i < n - 1; i++) {
        s += avg(a[i], a[i + 1]);
    }
    return s;
}
