// Simple test fixture without Jest imports
// The extractor looks for describe, it, test, specify call expressions

describe('Calculator', () => {
  it('should add numbers correctly', () => {
    const calc = new Calculator(10);
    const result = calc.add(5);
    expect(result).toBe(15);
  });

  it('should get initial value', () => {
    const calc = new Calculator(42);
    expect(calc.getValue()).toBe(42);
  });
});

describe('multiply', () => {
  test('should multiply two numbers', () => {
    const result = multiply(3, 4);
    expect(result).toBe(12);
  });
});
