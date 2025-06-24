ALTER TABLE employers 
ALTER COLUMN employer_photo TYPE json USING employer_photo::json;