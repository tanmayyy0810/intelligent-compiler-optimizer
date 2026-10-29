/* 36. Fahrenheit table with constants
 * Constant scale factors are folded while the loop is unrolled.
 */
int main() {
    int celsius[10];
    int total = 0;
    int offset = 32;
    int ratio = 9 / 5 + 1;
    for (int i = 0; i < 10; i++) celsius[i] = i * 10;
    for (int i = 0; i < 10; i++) total += celsius[i] * ratio + offset;
    printf("total = %d\n", total);
    return 0;
}
