// Full sheet column order, relative to the Email column (offset 0).
// null = column exists in sheet but has no matching modal field (skip).
export const PASTE_OFFSET_MAP: Record<number, string | null> = {
  [-3]: 'Account',
  [-2]: 'Country',
  [-1]: 'Proxy Used',
  [0]:  'Email',
  [1]:  'Password',
  [2]:  'Account Name',
  [3]:  'Account Surname',
  [4]:  'Process',
  [5]:  'Details',
  [6]:  'Brand Name',
  [7]:  'Removed / Not Published / stil published date',
  [8]:  'Score added',
  [9]:  'Trust Pilot',
  [10]: 'Link to the profile',
  [11]: 'TP Review Status',
  [12]: null, // Redirection from Search Engine
  [13]: null, // Redirection Word used
  [14]: null, // Review Language
  [15]: 'Register from Google acount',
  [16]: 'Leaving Review After redirected from  welcome Email',
  [17]: 'Sticky IP (Mobile) (Y/N)',
  [18]: 'Photo in Account?',
  [19]: null, // Mobile or desktop
  [20]: 'Opening the account via "usefull"',
  [21]: 'Opening the account via "Register" when leaving review',
  [22]: 'Scrolling and houvering?',
  [23]: 'Smart Paste?/ Paste as human typing?',
  [24]: null, // Mentioning time frames
  [25]: null, // Mentioning Amounts
  [26]: null, // Mentioning Agent name
  [27]: null, // Short review / Long
  [28]: 'Native Language?',
};
