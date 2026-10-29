#include <stdlib.h>
#include <stdio.h>
int main() {
    int *p = (int*) malloc(5 * sizeof(int));
    int *q = (int*) calloc(5, sizeof(int));
    for (int i = 0; i < 5; i++) { p[i] = i * 2; q[i] = p[i] + 1; }
    p = (int*) realloc(p, 10 * sizeof(int));
    p[9] = 42;
    int s = 0;
    for (int i = 0; i < 5; i++) s += q[i];
    printf("%d %d\n", s, p[9]);
    free(p); free(q);
    return s;
}
