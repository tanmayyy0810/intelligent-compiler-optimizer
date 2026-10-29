/* 06. Floating-point constant folding
 * double arithmetic on constants is folded with the same rounding the program would use.
 */
double circle_area() {
    double pi = 3.14159;
    double r = 2.0;
    return pi * r * r;
}
