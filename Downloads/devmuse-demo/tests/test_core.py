import unittest
from app.core import calculate_order

class OrderTests(unittest.TestCase):
    def test_regular_order(self):
        self.assertEqual(calculate_order("book", 2)["total"], "50.00")

    def test_valid_discount(self):
        self.assertEqual(calculate_order("mouse", 1, 25)["total"], "30.00")

    def test_unknown_item(self):
        with self.assertRaisesRegex(ValueError, "Unknown item"):
            calculate_order("not-real", 1)

    def test_zero_quantity(self):
        with self.assertRaises(ValueError):
            calculate_order("book", 0)

if __name__ == "__main__":
    unittest.main()
