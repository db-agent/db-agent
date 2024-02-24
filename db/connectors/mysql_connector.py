from mysql.connector import connect, Error
from db.connectors.base_connector import BaseConnector

class MySQLConnector(BaseConnector):
    def __init__(self, config):
        self.config = config
        self.connection = None
        self.cursor = None

    def connect(self):
        try:
            self.connection = connect(**self.config)
            self.cursor = self.connection.cursor(dictionary=True)
        except Error as e:
            print(f"Error connecting to MySQL database: {e}")

    def query(self, query, params=None):
        if self.connection is None or self.cursor is None:
            self.connect()
        try:
            self.cursor.execute(query, params or ())
            if query.lower().startswith("select"):
                return self.cursor.fetchall()
            else:
                self.connection.commit()
        except Error as e:
            print(f"Error executing MySQL query: {e}")

    def close(self):
        if self.cursor:
            self.cursor.close()
        if self.connection:
            self.connection.close()
        self.cursor = None
        self.connection = None
