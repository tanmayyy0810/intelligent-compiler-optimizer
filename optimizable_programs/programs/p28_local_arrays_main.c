/* 28. Local arrays in main
 * Distinct local arrays can never alias; both loops have a constant trip count of 100.
 */
int main() {
    int a[100]; int b[100]; int c[100];
    for (int i = 0; i < 100; i++) { a[i] = i; b[i] = 2 * i; }
    for (int i = 0; i < 100; i++) c[i] = a[i] + b[i];
    return c[99];
}
