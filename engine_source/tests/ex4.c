int fold() { int x = 10 + 20; int y = x * 2; return y; }
int heap() {
    int *p = malloc(10 * sizeof(int));
    for (int i = 0; i < 10; i++) p[i] = i * i;
    int r = p[3] + p[4];
    free(p);
    return r;
}
int* leak() { int *p = malloc(16); p[0] = 1; return p; }
int branch(int n) { int k = 3; if (k > 5) { n = n * 100; } else { n = n + 1; } return n; }
int mat(int * restrict a, int * restrict b, int * restrict c, int n) {
    for (int i = 0; i < n; i++)
      for (int j = 0; j < n; j++) {
        int s = 0;
        for (int k = 0; k < n; k++) s += a[i*n+k] * b[k*n+j];
        c[i*n+j] = s;
      }
    return 0;
}
int gather(int * restrict a, int * restrict idx, int * restrict o, int n) { for (int i=0;i<n;i++) o[i]=a[idx[i]]; return 0; }
int cond(int * restrict a, int n){ for(int i=0;i<n;i++){ if(a[i]>50) a[i]=50; } return 0; }
int w(int n){ int i=0; int s=0; while(i<n){ s+=i; i++; } return s; }
