/* 02. Propagation chain
 * A constant flows through several variables; each use is replaced by the value and folded.
 */
int main() {
    int x = 5;
    int y = x * 2;
    int z = y + x;
    int w = z * z;
    return w - 100;
}
