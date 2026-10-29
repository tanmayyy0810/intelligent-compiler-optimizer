int prefix(int *a, int n) {
    for (int i = 1; i < n; i++) a[i] = a[i-1] + a[i];
    return a[n-1];
}
int sum(int * restrict a, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i];
    return s;
}
void shift(int * restrict a, int n) { for (int i = 0; i < n - 1; i++) a[i] = a[i+1]; }
void stride2(int * restrict a, int n) { for (int i = 0; i < n; i += 2) a[i] = a[i] + 1; }
