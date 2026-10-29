#include <stdio.h>
int main() {
    int n, sum = 0;
    scanf("%d", &n);
    for (int i = 0; i < n; i++) {
        int v;
        scanf("%d", &v);
        if (v % 2 == 0) continue;
        if (v > 25) break;
        sum += v;
    }
    int k = 0;
    do { k++; } while (k < 5);
    switch (n % 4) {
        case 0: printf("zero\n");
        case 1: printf("one\n"); break;
        case 2: printf("two\n"); break;
        default: printf("other\n");
    }
    printf("n=%d sum=%d k=%d\n", n, sum, k);
    return sum;
}
