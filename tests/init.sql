-- Create the Department table with a unique constraint on department_name
CREATE TABLE IF NOT EXISTS Department (
    department_id SERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL UNIQUE
);

-- Create the Employee table with a UNIQUE constraint on employee_name
CREATE TABLE IF NOT EXISTS Employee (
    employee_id SERIAL PRIMARY KEY,
    employee_name VARCHAR(100) NOT NULL UNIQUE,
    salary DECIMAL(10, 2),
    department_id INT,
    FOREIGN KEY (department_id) REFERENCES Department(department_id)
);



-- Insert sample data into Department table (with UNIQUE constraint)
INSERT INTO Department (department_name) 
VALUES
  ('Human Resources'),
  ('Engineering'),
  ('Sales'),
  ('Marketing');

-- Insert sample data into Employee table
INSERT INTO Employee (employee_name, salary, department_id) 
VALUES
  ('John Doe', 50000.00, 1),
  ('Jane Smith', 60000.00, 2),
  ('Alice Johnson', 55000.00, 2),
  ('Bob Brown', 45000.00, 3),
  ('Mary White', 70000.00, 4);
