/* 35. Fill, transform, checksum, print
 * Several loops in one program; the loops are optimized, printf stays outside them.
 */
int main() {
    int a[64]; int b[64];
    for (int i = 0; i < 64; i++) a[i] = i * 3;
    for (int i = 0; i < 64; i++) b[i] = a[i] + 7;
    int sum = 0;
    for (int i = 0; i < 64; i++) sum += b[i];
    printf("checksum = %d\n", sum);
    return 0;
}
