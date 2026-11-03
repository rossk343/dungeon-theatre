using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DungeonTheatre.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTokenImage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ImageUrl",
                table: "Tokens",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImageUrl",
                table: "Tokens");
        }
    }
}
