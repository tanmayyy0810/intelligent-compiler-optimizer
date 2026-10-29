int calculate(int *a, int *b, int n) {
    int x = 10 * 20;
    for (int i = 0; i < n; i++) {
        a[i] = b[i] + x;
    }
    return x;
}
