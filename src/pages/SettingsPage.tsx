import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store, User, DollarSign, Palette, Database,
  ChevronRight, Save, Moon, Sun, Check, UserPlus, Trash2, Edit,
  Loader2, Download, Eye, EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { usePOS } from '@/contexts/POSContext';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import themastersLogo from '@/assets/themasters-logo.png';

const settingsSections = [
  { id: 'business', label: 'Business Profile', icon: Store, shortcut: '1' },
  { id: 'users', label: 'User Management', icon: User, shortcut: '2' },
  { id: 'currency', label: 'Currency & Tax', icon: DollarSign, shortcut: '3' },
  { id: 'appearance', label: 'Appearance', icon: Palette, shortcut: '4' },
  { id: 'backup', label: 'Backup & Restore', icon: Database, shortcut: '6' },
];

export const SettingsPage = () => {
  const { currentUser } = usePOS();
  const queryClient = useQueryClient();
  const isAdmin = currentUser?.role === 'admin';
  
  // UI State
  const [activeSection, setActiveSection] = useState('business');
  const [isDark, setIsDark] = useState(true);
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);
  
  // Data State
  const [formData, setFormData] = useState<any>({});
  const [userForm, setUserForm] = useState<any>({ permissions: {} });

  // --- 1. FETCH SETTINGS ---
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await supabase.from('store_settings').select('*').single();
      return data || {};
    },
    staleTime: 1000 * 60 * 60
  });

  // --- 2. FETCH USERS ---
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').order('full_name');
      return data || [];
    },
    enabled: isAdmin 
  });

  // Sync settings to form
  useEffect(() => { if (settings) setFormData(settings); }, [settings]);

  // --- 3. SAVE SETTINGS MUTATION ---
  const saveSettingsMutation = useMutation({
    mutationFn: async (newSettings: any) => {
      const { error } = await supabase.from('store_settings').upsert({
        id: settings?.id,
        ...newSettings,
        updated_at: new Date()
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success("Settings Saved");
    },
    onError: (err: any) => toast.error(err.message)
  });

  // --- 4. USER MUTATIONS (USERNAME FIX) ---
  const saveUserMutation = useMutation({
    mutationFn: async (userData: any) => {
      
      // CASE A: EDITING
      if (editingUser) {
        const { error } = await supabase.from('profiles').update({
          full_name: userData.name,
          role: userData.role,
          permissions: userData.permissions,
          pin_code: userData.pin_code
        }).eq('id', editingUser.id);
        
        if (error) throw error;
      } 
      
      // CASE B: CREATING NEW USER
      else {
        // 1. Generate Fake Email from Username
        const cleanUsername = userData.username.trim().toLowerCase();
        const fakeEmail = `${cleanUsername}@themasters.com`;
        
        // 2. Register in Supabase Auth
        const { data, error } = await supabase.auth.signUp({
          email: fakeEmail,
          password: userData.password,
          options: {
            data: { full_name: userData.name } 
          }
        });

        if (error) throw error;

        // 3. Create Profile Row
        if (data.user) {
          const { error: profileError } = await supabase.from('profiles').insert({
            id: data.user.id,
            full_name: userData.name,
            role: userData.role,
            permissions: userData.permissions,
            pin_code: userData.pin_code
          });
          
          if (profileError) throw profileError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(editingUser ? "User Updated" : "User Created Successfully");
      setShowUserDialog(false);
    },
    onError: (err: any) => {
      if (err.message.includes("already registered")) {
        toast.error("Username is already taken.");
      } else {
        toast.error(err.message);
      }
    }
  });

  // --- 5. KEYBOARD NAV ---
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (e.key >= '1' && e.key <= '5') {
      const index = parseInt(e.key) - 1;
      if (settingsSections[index]) setActiveSection(settingsSections[index].id);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  // --- 6. EXPORT DATA ---
  const handleExportData = async () => {
    if (!isAdmin) return;
    toast.loading("Generating Backup...");
    
    const [products, orders, items] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('order_items').select('*')
    ]);

    const backup = {
      timestamp: new Date(),
      products: products.data,
      orders: orders.data,
      order_items: items.data,
      settings: settings
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    toast.dismiss();
    toast.success("Backup Downloaded");
  };

  const openUserEdit = (user: any) => {
    setEditingUser(user);
    setUserForm({
      name: user.full_name,
      username: '', // Can't edit username easily in Supabase without edge functions
      role: user.role,
      permissions: user.permissions || {},
      pin_code: user.pin_code || ''
    });
    setShowUserDialog(true);
  };

  const handleAddUser = () => {
    setEditingUser(null);
    setUserForm({ 
      name: '', 
      username: '', 
      password: '', 
      role: 'cashier', 
      permissions: {
        allowRefunds: false,
        allowVoid: false,
        allowPriceEdit: false,
        allowDiscount: false,
        allowReports: false,
        allowInventory: false,
      }, 
      pin_code: '' 
    });
    setShowUserDialog(true);
  };

  const handlePermissionToggle = (key: string) => {
    setUserForm((prev: any) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: !prev.permissions[key]
      }
    }));
  };

  return (
    <div className="flex flex-col lg:flex-row h-full gap-6 p-6 bg-slate-50 dark:bg-slate-950 min-h-screen">
      
      {/* SIDEBAR */}
      <div className="w-full lg:w-64 flex flex-col gap-1 shrink-0">
        <h1 className="text-2xl font-bold mb-4 px-2">Settings</h1>
        {settingsSections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all',
              activeSection === section.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-muted-foreground'
            )}
          >
            <span className="text-[10px] font-mono opacity-50 w-4 border border-current rounded text-center">{section.shortcut}</span>
            <section.icon className="w-5 h-5" />
            <span className="font-medium">{section.label}</span>
            {activeSection === section.id && <ChevronRight className="w-4 h-4 ml-auto" />}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div className="flex-1 max-w-4xl">
        <AnimatePresence mode='wait'>
          
          {/* 1. BUSINESS */}
          {activeSection === 'business' && (
            <motion.div initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0}} className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Business Profile</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-xl border border-border">
                    <img src={themastersLogo} alt="Logo" className="h-16 object-contain" style={{ filter: 'invert(1)' }} />
                    <div>
                      <h3 className="font-bold text-lg">{formData.business_name}</h3>
                      <p className="text-sm text-muted-foreground">System Configuration</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Business Name</Label>
                      <Input value={formData.business_name || ''} onChange={e => setFormData({...formData, business_name: e.target.value})} disabled={!isAdmin}/>
                    </div>
                    <div className="space-y-2">
                      <Label>Tax ID / ZIMRA</Label>
                      <Input value={formData.tax_id || ''} onChange={e => setFormData({...formData, tax_id: e.target.value})} disabled={!isAdmin}/>
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input value={formData.phone || ''} onChange={e => setFormData({...formData, phone: e.target.value})} disabled={!isAdmin}/>
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} disabled={!isAdmin}/>
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Address</Label>
                      <Input value={formData.address || ''} onChange={e => setFormData({...formData, address: e.target.value})} disabled={!isAdmin}/>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* 2. USERS */}
          {activeSection === 'users' && (
            <motion.div initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0}} className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Staff Management</CardTitle>
                  {isAdmin && (
                    <Button size="sm" className="gap-2" onClick={handleAddUser}>
                      <UserPlus className="w-4 h-4" /> Add User
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {users.map((user: any) => (
                    <div key={user.id} className="flex items-center justify-between p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                          {user.full_name?.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{user.full_name}</span>
                            <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">ID: {user.id.slice(0,8)}...</p>
                        </div>
                      </div>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => openUserEdit(user)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* 3. CURRENCY */}
          {activeSection === 'currency' && (
            <motion.div initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0}} className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Financial Settings</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Currency Symbol</Label>
                      <Select 
                        value={formData.currency || 'USD'} 
                        onValueChange={v => setFormData({...formData, currency: v})}
                        disabled={!isAdmin}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD ($)</SelectItem>
                          <SelectItem value="ZWG">ZWG (ZiG)</SelectItem>
                          <SelectItem value="ZAR">ZAR (R)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Tax Rate (%)</Label>
                      <Input 
                        type="number" 
                        value={formData.tax_rate || 0} 
                        onChange={e => setFormData({...formData, tax_rate: e.target.value})}
                        disabled={!isAdmin}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium">Prices Include Tax</p>
                      <p className="text-xs text-muted-foreground">If checked, tax is calculated backwards from price</p>
                    </div>
                    <Switch 
                      checked={formData.tax_included} 
                      onCheckedChange={c => setFormData({...formData, tax_included: c})}
                      disabled={!isAdmin}
                    />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* 4. APPEARANCE */}
          {activeSection === 'appearance' && (
            <motion.div initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0}} className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Theme Preferences</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <button onClick={() => isDark && toggleTheme()} className={cn("p-4 rounded-xl border-2 text-left transition-all", !isDark ? "border-primary bg-primary/5" : "border-border")}>
                    <div className="flex justify-between mb-2"><Sun className="w-6 h-6"/> {!isDark && <Check className="w-4 h-4 text-primary"/>}</div>
                    <p className="font-bold">Light Mode</p>
                  </button>
                  <button onClick={() => !isDark && toggleTheme()} className={cn("p-4 rounded-xl border-2 text-left transition-all", isDark ? "border-primary bg-primary/5" : "border-border")}>
                    <div className="flex justify-between mb-2"><Moon className="w-6 h-6"/> {isDark && <Check className="w-4 h-4 text-primary"/>}</div>
                    <p className="font-bold">Dark Mode</p>
                  </button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* 5. BACKUP */}
          {activeSection === 'backup' && (
            <motion.div initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0}} className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Data Management</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-8 border-2 border-dashed border-border rounded-xl text-center">
                    <Database className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-bold text-lg">Local Database Backup</h3>
                    <p className="text-sm text-muted-foreground mb-6">Export all products, sales, and settings to a JSON file.</p>
                    <div className="flex justify-center gap-4">
                      <Button variant="outline" onClick={handleExportData} className="gap-2">
                        <Download className="w-4 h-4" /> Export Backup
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

        </AnimatePresence>

        {/* Global Save Button */}
        {isAdmin && (
          <div className="mt-6 flex justify-end">
            <Button size="lg" className="bg-primary hover:bg-blue-600 gap-2" onClick={() => saveSettingsMutation.mutate(formData)} disabled={saveSettingsMutation.isPending}>
              {saveSettingsMutation.isPending ? <Loader2 className="animate-spin"/> : <Save className="w-4 h-4"/>}
              Save Changes
            </Button>
          </div>
        )}
      </div>

      {/* USER EDIT DIALOG */}
      <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingUser ? 'Edit Permissions' : 'Create User'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={userForm.name} onChange={e => setUserForm({...userForm, name: e.target.value})} placeholder="John Doe" />
            </div>
            
            {/* Show Username/Password only when creating NEW user */}
            {!editingUser && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} placeholder="johnd" />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <div className="relative">
                    <Input 
                      type={showPassword ? 'text' : 'password'} 
                      value={userForm.password} 
                      onChange={e => setUserForm({...userForm, password: e.target.value})} 
                      placeholder="****"
                    />
                    <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={()=>setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff className="w-3 h-3"/> : <Eye className="w-3 h-3"/>}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={userForm.role} onValueChange={v => setUserForm({...userForm, role: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="cashier">Cashier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Login PIN (Quick Access)</Label>
              <Input type="password" value={userForm.pin_code} onChange={e => setUserForm({...userForm, pin_code: e.target.value})} placeholder="****" maxLength={4}/>
            </div>

            {/* Permissions */}
            {userForm.role === 'cashier' && (
              <div className="space-y-3 pt-2">
                <Label>Permissions</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'allowRefunds', label: 'Refunds' },
                    { key: 'allowVoid', label: 'Void Sales' },
                    { key: 'allowPriceEdit', label: 'Edit Prices' },
                    { key: 'allowDiscount', label: 'Give Discounts' },
                    { key: 'allowReports', label: 'View Reports' },
                    { key: 'allowInventory', label: 'Edit Inventory' },
                  ].map(({key, label}) => (
                    <div key={key} className="flex items-center justify-between p-2 rounded bg-muted/50 border border-border">
                      <span className="text-sm">{label}</span>
                      <Switch 
                        checked={userForm.permissions?.[key]} 
                        onCheckedChange={() => handlePermissionToggle(key)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserDialog(false)}>Cancel</Button>
            <Button onClick={() => saveUserMutation.mutate(userForm)} disabled={saveUserMutation.isPending}>
              {saveUserMutation.isPending ? <Loader2 className="animate-spin"/> : "Save User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};