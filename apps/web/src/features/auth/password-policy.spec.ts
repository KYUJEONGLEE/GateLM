import { expect, test } from "@playwright/test";
import { isPasswordPolicySatisfied } from "./password-policy";

test("accepts only 8 to 15 character passwords with every required character class", () => {
  expect(isPasswordPolicySatisfied("Aa1!aaaa")).toBe(true);
  expect(isPasswordPolicySatisfied("Aa1!aaaaaaaaaaa")).toBe(true);
  expect(isPasswordPolicySatisfied("Aa1!aaa")).toBe(false);
  expect(isPasswordPolicySatisfied("Aa1!aaaaaaaaaaaa")).toBe(false);
  expect(isPasswordPolicySatisfied("aa1!aaaa")).toBe(false);
  expect(isPasswordPolicySatisfied("AA1!AAAA")).toBe(false);
  expect(isPasswordPolicySatisfied("Aa!!aaaa")).toBe(false);
  expect(isPasswordPolicySatisfied("Aa11aaaa")).toBe(false);
  expect(isPasswordPolicySatisfied("Aa1! aaa")).toBe(false);
});
