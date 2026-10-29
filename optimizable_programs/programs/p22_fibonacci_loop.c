/* 22. Iterative Fibonacci
 * Three loop-carried scalars; unrolling is safe, vectorization is not possible.
 */
int fib(int n) {
    int a = 0, b = 1;
    for (int i = 0; i < n; i++) {
        int t = a + b;
        a = b;
        b = t;
    }
    return a;
}
