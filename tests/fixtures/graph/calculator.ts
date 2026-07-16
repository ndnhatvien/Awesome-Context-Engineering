// Simple TypeScript fixture for graph extraction testing
import { calculateSum } from './helper';

export class Calculator {
  private value: number;

  constructor(initialValue: number) {
    this.value = initialValue;
  }

  add(n: number): number {
    this.value = calculateSum(this.value, n);
    return this.value;
  }

  getValue(): number {
    return this.value;
  }
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export const PI = 3.14159;
