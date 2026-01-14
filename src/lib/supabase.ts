import { createClient } from '@supabase/supabase-js';

// 1. Get Keys from the .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 2. Safety Check
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ SUPABASE ERROR: Missing URL or Key. Check your .env file.');
}

// 3. Initialize the Real Connection
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// 4. Define Types (This tells the code what your Database looks like)

export interface Product {
  id: string;
  name: string;
  category: string | null;
  type: 'good' | 'service'; // Crucial for TheMasters logic
  description: string | null;
  price: number;
  cost_price: number;
  stock_quantity: number;
  low_stock_threshold: number;
  is_variable_price: boolean; // For custom repair prices
  requires_note: boolean;     // For repair details
  created_at: string;
}

export interface Order {
  id: string;
  cashier_id: string;
  customer_name: string | null;
  customer_contact: string | null;
  total_amount: number;
  payment_method: 'cash' | 'ecocash' | 'card' | 'mixed';
  status: 'completed' | 'voided' | 'refunded';
  order_number?: number;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  price_at_sale: number;
  service_note: string | null; // e.g. "Screen Model A50"
}

export interface Profile {
  id: string;
  full_name: string | null;
  role: 'admin' | 'cashier';
  pin_code: string | null;
  permissions: any; // JSON object
}