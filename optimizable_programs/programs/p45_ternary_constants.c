/* 45. Conditional operator on constants
 * k > 3 ? 10 : 20 is lowered to a branch; the constant condition removes the unused arm.
 */
int main() {
    int k = 5;
    int m = k > 3 ? 10 : 20;
    return m + 1;
}
