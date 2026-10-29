#include <stdio.h>
#include <stdlib.h>
#define N 3
int g = 5;
int counter;
int table[4] = {1, 2, 3, 4};

int fib(int n) {
    int a = 0, b = 1;
    for (int i = 0; i < n; i++) { int t = a + b; a = b; b = t; }
    return a;
}
long fact(int n) { long r = 1; for (int i = 2; i <= n; i++) r *= i; return r; }
void swap(int *a, int *b) { int t = *a; *a = *b; *b = t; }
float avg(float *v, int n) { float s = 0; for (int i = 0; i < n; i++) s += v[i]; return s / n; }
double area(double r) { return 3.14159 * r * r; }
char upper(char c) { if (c >= 'a' && c <= 'z') return c - 32; return c; }
int trace(int m[N][N]) { int s = 0; for (int i = 0; i < N; i++) s += m[i][i]; return s; }
int main() {
    int a[3][3] = {{1,2,3},{4,5,6},{7,8,9}};
    int x = 3, y = 7;
    swap(&x, &y);
    printf("x=%d y=%d\n", x, y);
    printf("fib(10)=%d fact(10)=%ld area=%.2f\n", fib(10), fact(10), area(2.0));
    printf("%c %s\n", upper('q'), "hello");
    counter += g + table[2];
    printf("counter=%d trace=%d a12=%d\n", counter, trace(a), a[1][2]);
    return 0;
}
